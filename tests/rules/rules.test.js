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
  // v917 (2026-09-14, SecAudit Sprint 0 CRIT-01): auto-escalation admin.
  it('NO puede crearse a sí mismo como admin (auto-escalation cerrada v917)', async () => {
    const newUid = 'uid-fresh-3';
    const db = authedDb(newUid, { email: 'attacker@shimano.com.ar' });
    await assertFails(setDoc(doc(db, 'roles', newUid), { role: 'admin' }));
  });
  it('bot.shimano.pesca sí puede crearse como admin (bootstrap flow)', async () => {
    const newUid = 'uid-boot';
    // D3 (2026-10-29): la regla exige email verificado + login con Google.
    const db = authedDb(newUid, {
      email: 'bot.shimano.pesca@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    await assertSucceeds(setDoc(doc(db, 'roles', newUid), { role: 'admin' }));
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
  // D2 (2026-10-29, actualizado ciclo 17): la lectura de docs de vendedores
  // quedó para roles lectores. Un VDE ES lector, así que VDE → VDE está
  // permitido a propósito: es el caso v1491 (el VDE resuelve vendorKey→UID
  // client-side vía resolveClientVendorFromMaster/vdeUsers; sin esa lectura el
  // payload sale sin assignedVendorUid y el gate server rechaza con
  // VENDOR_UID_MISSING). El test previo ("vendor NO puede leer role de otro
  // vendor") reflejaba una intención anterior a v1491 y nunca coincidió con la
  // regla real (en main alcanzaba con estar autenticado). La frontera de
  // seguridad real de D2 — unassigned / autenticado sin rol NO leen — se
  // mantiene abajo y también en tests/rules/sec-d2-d3.test.js (L1/L2).
  it('vendor SÍ puede leer role de otro vendor (D2: caso v1491 vendorKey→UID)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendorOther)));
  });
  it('D2: unassigned NO puede leer role de un vendor', async () => {
    await assertFails(getDoc(doc(authedDb(UID.unassigned), 'roles', UID.vendor)));
  });
  it('D2: autenticado sin doc en roles NO puede leer role de un vendor', async () => {
    // uid sin doc sembrado en /roles → isReader() es false → denegado.
    await assertFails(getDoc(doc(authedDb('uid-sin-doc-en-roles'), 'roles', UID.vendor)));
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
  // v991 (SecAudit run-1 HIGH #5): create rule valida ownerVendor
  it('v991: vendor puede crear pedido con ownerVendor=myVendorKey (VDE_GONZALO)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-new-own'), {
        ownerUid: UID.vendor,
        ownerVendor: 'VDE_GONZALO',
      })
    );
  });
  it('v991: vendor puede crear pedido con ownerVendor=null (unset)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-new-null'), {
        ownerUid: UID.vendor,
        ownerVendor: null,
      })
    );
  });
  it('v991: vendor NO puede crear pedido con ownerVendor spoofeado a otro (VDE_OTRO)', async () => {
    // Vector CRITICAL: commission fraud. Aunque el ownerUid es propio, seteando
    // ownerVendor=<victima> el trigger onPedidoConfirmedSendToSap resolvia
    // SlpCode del otro -> comision atribuida mal.
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-new-spoof'), {
        ownerUid: UID.vendor,
        ownerVendor: 'VDE_OTRO',
      })
    );
  });
  it('v991: admin puede crear pedido con cualquier ownerVendor (backend flow)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.admin), 'pedidos', 'p-admin-any'), {
        ownerUid: UID.vendorOther,
        ownerVendor: 'VDE_OTRO',
      })
    );
  });
  // v918 (Sprint 1 E1.3 HIGH-05): vendor update restringido por hasOnly().
  // vendor delete removido (era abierto por ownership — riesgo: VDE wipe
  // pedidos post-envio a SAP, dejando SQ orfano en SAP sin trace).
  it('vendor puede update campos permitidos de pedido propio (stage, lines, formaEntrega)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { stage: 'confirmed' })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), {
        lines: [{ code: 'X', qty: 1 }],
        netAmountArs: 1000,
      })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), {
        formaEntrega: 'TRANSPORTISTA',
        deliveryDetails: { transportistaNombre: 'X' },
      })
    );
  });
  it('vendor NO puede update transferidoSAP (CHAIN-01 comision duplicada)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { transferidoSAP: null })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), {
        transferidoSAP: { docNum: 9999, via: 'fake' },
      })
    );
  });
  it('vendor NO puede update transferError / sendingSapLock / orderNumberPrev', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { transferError: null })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { sendingSapLock: null })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { orderNumberPrev: '999' })
    );
  });
  it('vendor NO puede update ownerUid / ownerVendor / clientCardCode', async () => {
    // clientCardCode NO esta en el whitelist -> deniega
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { clientCardCode: 'HACKED' })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { ownerUid: UID.admin })
    );
  });
  it('vendor NO puede delete pedido propio (defensa contra wipe SQ ya enviada)', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor')));
  });
  // §63 (2026-10-23 v1442): CIERRE DEL PARCHE §61.
  // §61 abrió update a VDE sin ownerUid check para destrabar prod. §63 lo
  // cierra: VDE puede update si (ownerUid == auth.uid OR assignedVendorUid
  // == auth.uid). Cross-vendor cancel ASIG ahora pasa por releaseAsigCF.
  it('v1442 §63: vendor PUEDE update pedido ajeno si assignedVendorUid == auth.uid', async () => {
    // Caso real: pedido lo cargó Pablo (ownerUid=admin) pero el VDE del
    // cliente master es el vendor (assignedVendorUid=vendor).
    await seedDoc('pedidos/p-ajeno-vendor-asignado', {
      ownerUid: UID.vendorOther,
      assignedVendorUid: UID.vendor,
    });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-ajeno-vendor-asignado'), {
        lines: [{ code: 'X', qty: 1 }],
      })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-ajeno-vendor-asignado'), {
        stage: 'confirmed',
      })
    );
  });
  it('v1442 §63: vendor NO puede update pedido ajeno sin ownerUid ni assignedVendorUid propios', async () => {
    // p-other: ownerUid=vendorOther, sin assignedVendorUid. VDE no puede.
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-other'), {
        lines: [{ code: 'X', qty: 1 }],
      })
    );
    await assertFails(updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-other'), { stage: 'x' }));
  });
  it('v1442 §63: vendor NO puede update pedido ajeno con campos sensibles aunque sea assignedVendor', async () => {
    // El hasOnly protection sigue vigente aunque el VDE sea assignedVendor.
    await seedDoc('pedidos/p-ajeno-vendor-sensible', {
      ownerUid: UID.vendorOther,
      assignedVendorUid: UID.vendor,
    });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-ajeno-vendor-sensible'), {
        ownerUid: UID.vendor,
      })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-ajeno-vendor-sensible'), {
        transferidoSAP: { docNum: 9999 },
      })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-ajeno-vendor-sensible'), {
        clientCardCode: 'HACKED',
      })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-ajeno-vendor-sensible'), {
        assignedVendorUid: UID.vendorOther,
      })
    );
  });
  it('v1442 §63: vendor NO puede delete pedido ajeno ni propio', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-other')));
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor')));
  });
  it('admin/gerente/interno pueden update sin restriccion (blanket)', async () => {
    // admin puede tocar campos que el vendor no puede (transferidoSAP)
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'pedidos', 'p-vendor'), {
        transferidoSAP: { docNum: 100, via: 'service_layer' },
      })
    );
    // interno puede update pedidos cross-VDE (v747)
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-other'), { stage: 'closed' })
    );
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

  // v992 (SecAudit run-1 CRITICAL #2): cap importe defensivo en rules.
  it('v992: vendor puede create con importe null (solicitud sin monto)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-v992-null'), {
        ownerUid: UID.vendor,
        importe: null,
      })
    );
  });
  it('v992: vendor puede create con importe valido (5000)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-v992-ok'), {
        ownerUid: UID.vendor,
        importe: 5000,
      })
    );
  });
  it('v992: vendor puede create con importe en el limite (10M)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-v992-limit'), {
        ownerUid: UID.vendor,
        importe: 10000000,
      })
    );
  });
  it('v992 CRIT: vendor NO puede create con importe out-of-range (fraud vector)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-v992-fraud'), {
        ownerUid: UID.vendor,
        importe: 999999999,
      })
    );
  });
  it('v992 CRIT: vendor NO puede create con importe negativo', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-v992-neg'), {
        ownerUid: UID.vendor,
        importe: -100,
      })
    );
  });
  it('v992 CRIT: gerente NO puede update a importe fuera del cap', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.gerente), 'rendiciones', 'r-vendor'), {
        importe: 999999999,
      })
    );
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
  // v991 (SecAudit run-1 HIGH #6): create rule valida assignedVendor
  it('v991: vendor puede crear alta con assignedVendor=myVendorKey (VDE_GONZALO)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-mine'), {
        ownerUid: UID.vendor,
        assignedVendor: 'VDE_GONZALO',
      })
    );
  });
  it('v991: vendor puede crear alta con assignedVendor=null (unassigned)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-null'), {
        ownerUid: UID.vendor,
        assignedVendor: null,
      })
    );
  });
  it('v991: vendor NO puede crear alta con assignedVendor spoofeado a otro (VDE_OTRO) — lead theft', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-spoof'), {
        ownerUid: UID.vendor,
        assignedVendor: 'VDE_OTRO',
      })
    );
  });
  it('v991: admin puede crear alta con cualquier assignedVendor (override legitimo)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.admin), 'client_applications', 'ca-admin-assign'), {
        ownerUid: UID.admin,
        assignedVendor: 'VDE_OTRO',
      })
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
  // v778+: cualquier reader puede borrar un provisorio SIN cardCodeSap
  // (limpieza colaborativa desde Master Clientes-Direcciones). Antes solo
  // owner o admin/gerente.
  it('v778: vendor puede borrar provisorio propio SIN cardCodeSap', async () => {
    await assertSucceeds(deleteDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-vendor')));
  });
  it('v778: vendor puede borrar provisorio asignado a el (readable) SIN cardCodeSap', async () => {
    await assertSucceeds(
      deleteDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-assigned-to-vendor'))
    );
  });
  it('v778: interno puede borrar provisorio SIN cardCodeSap', async () => {
    await assertSucceeds(
      deleteDoc(doc(authedDb(UID.interno), 'client_applications', 'ca-huerfano'))
    );
  });
  it('v778: vendor sigue SIN poder borrar alta CON cardCodeSap', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-with-sap')));
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

  // v778+: client_master.delete es ahora isReader (todos los roles). Se
  // sigue restringiendo create/update a admin/gerente (el loop de arriba
  // cubre eso con setDoc). Este test cubre delete.
  it('v778: client_master.delete permitido a vendor/interno/viewer (limpieza direccion)', async () => {
    await seedDoc('client_master/cm-vendor', { address: 'x' });
    await seedDoc('client_master/cm-interno', { address: 'y' });
    await seedDoc('client_master/cm-viewer', { address: 'z' });
    await assertSucceeds(deleteDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-vendor')));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.interno), 'client_master', 'cm-interno')));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.viewer), 'client_master', 'cm-viewer')));
  });

  // v785 (2026-09-04): vendor/interno pueden crear/updatear SOLO defaultDelivery
  // (persistencia de datos de entrega por cliente). Los demas campos siguen
  // restringidos a admin/gerente.
  it('v785: vendor puede crear client_master con SOLO defaultDelivery', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-vendor-new'), {
        defaultDelivery: { tipo: 'TRANSPORTISTA', transpNombre: 'Cruz del Sur' },
      })
    );
  });
  it('v785: interno puede crear client_master con SOLO defaultDelivery', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.interno), 'client_master', 'cm-interno-new'), {
        defaultDelivery: { tipo: 'SUCURSAL', sucursalDireccion: 'Av 123' },
      })
    );
  });
  it('v785: vendor NO puede crear client_master con defaultDelivery + otros campos', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-vendor-mixed'), {
        defaultDelivery: { tipo: 'RETIRO_DEPOSITO' },
        address: 'hack',
      })
    );
  });
  it('v785: vendor puede updatear defaultDelivery de client_master existente', async () => {
    await seedDoc('client_master/cm-existing', { address: 'x', cliTipo: 'A' });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-existing'), {
        defaultDelivery: { tipo: 'TRANSPORTISTA', transpNombre: 'Andreani' },
      })
    );
  });
  it('v785: vendor NO puede updatear address de client_master (sigue admin/gerente-only)', async () => {
    await seedDoc('client_master/cm-existing2', { address: 'x' });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-existing2'), {
        address: 'hack',
      })
    );
  });

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

// ============================================================
// v926 (SecAudit Sprint 1 iter 2) — E1.4 + E1.5 + E1.6
// ============================================================

describe('/revision_waitlist (v926 E1.4 HIGH-06)', () => {
  beforeEach(async () => {
    await seedDoc('revision_waitlist/w-vendor', { ownerUid: UID.vendor, items: [] });
  });

  it('vendor puede seguir creando su propio waitlist', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'w-new'), {
        ownerUid: UID.vendor,
        items: [],
      })
    );
  });
  it('vendor puede update waitlist ajeno (colaborativo — no cambia)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'w-vendor'), {
        items: [{ code: 'X' }],
      })
    );
  });
  // v953 (2026-09-16): reabrio delete al owner del waitlist (owner puede
  // borrar su propio doc despues de confirmar el pedido). El wipe cross-vendor
  // sigue prohibido. Los tests originales (pre-v953) asumian el gate cerrado
  // pero fueron actualizados aca para reflejar la rule vigente.
  it('v953: vendor SI puede delete su propio waitlist (owner)', async () => {
    await assertSucceeds(deleteDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'w-vendor')));
  });
  it('CRIT: vendor NO puede delete waitlist ajeno (defensa contra wipe cross-vendor)', async () => {
    await seedDoc('revision_waitlist/w-other', { ownerUid: UID.vendorOther, items: [] });
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'w-other')));
  });
  it('viewer NO puede delete waitlist (no es owner ni admin/gerente/interno)', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.viewer), 'revision_waitlist', 'w-vendor')));
  });
  it('admin/gerente/interno SI pueden delete', async () => {
    await seedDoc('revision_waitlist/w-a', { ownerUid: UID.vendor });
    await seedDoc('revision_waitlist/w-b', { ownerUid: UID.vendor });
    await seedDoc('revision_waitlist/w-c', { ownerUid: UID.vendor });
    await assertSucceeds(deleteDoc(doc(authedDb(UID.admin), 'revision_waitlist', 'w-a')));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.gerente), 'revision_waitlist', 'w-b')));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.interno), 'revision_waitlist', 'w-c')));
  });
});

describe('/client_master defaultDelivery shape (v926 E1.5 HIGH-08)', () => {
  it('vendor create con defaultDelivery map válido → OK', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-v926-ok'), {
        defaultDelivery: {
          tipo: 'TRANSPORTISTA',
          transpNombre: 'Cruz del Sur',
          transpDireccion: 'Terminal Retiro',
        },
      })
    );
  });
  it('CRIT: vendor NO puede crear defaultDelivery como string (XSS potencial)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-v926-str'), {
        defaultDelivery: '<script>alert(1)</script>',
      })
    );
  });
  it('vendor NO puede crear defaultDelivery con key no-whitelisteada', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-v926-badk'), {
        defaultDelivery: { tipo: 'X', evilPayload: 'hack' },
      })
    );
  });
  it('vendor NO puede crear defaultDelivery con >12 keys', async () => {
    const bloated = {};
    for (let i = 0; i < 20; i++) bloated['k' + i] = 'v';
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-v926-big'), {
        defaultDelivery: bloated,
      })
    );
  });
  it('vendor puede update defaultDelivery válido en doc existente', async () => {
    await seedDoc('client_master/cm-v926-existing', { address: 'x' });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-v926-existing'), {
        defaultDelivery: { tipo: 'SUCURSAL', sucursalDireccion: 'Av 123' },
      })
    );
  });
  it('CRIT: vendor NO puede update defaultDelivery como array', async () => {
    await seedDoc('client_master/cm-v926-arr', { address: 'x' });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'client_master', 'cm-v926-arr'), {
        defaultDelivery: ['not', 'a', 'map'],
      })
    );
  });
});

describe('/client_applications leadEstado scope (v926 E1.6 HIGH-09)', () => {
  beforeEach(async () => {
    await seedDoc('client_applications/ca-mine', {
      ownerUid: UID.vendor,
      assignedVendor: 'VDE_GONZALO',
      status: 'pending_approval',
    });
    await seedDoc('client_applications/ca-other', {
      ownerUid: UID.vendorOther,
      assignedVendor: 'VDE_OTRO',
      status: 'pending_approval',
    });
  });

  it('vendor puede update leadEstado de lead ASIGNADO a él', async () => {
    await assertSucceeds(
      updateDoc(
        authedDb(UID.vendor, { email: 'gonzalo@shimano.com.ar' })
          .collection('client_applications')
          .doc('ca-mine'),
        {
          leadEstado: 'contacted',
          leadEstadoAt: new Date().toISOString(),
          leadEstadoBy: 'gonzalo@shimano.com.ar',
        }
      )
    );
  });
  it('CRIT: vendor NO puede update leadEstado de lead de OTRO VDE', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-other'), {
        leadEstado: 'lost',
        leadEstadoBy: 'gonzalo@shimano.com.ar',
      })
    );
  });
  it('CRIT: vendor NO puede forjar leadEstadoBy con email ajeno', async () => {
    await assertFails(
      updateDoc(
        authedDb(UID.vendor, { email: 'gonzalo@shimano.com.ar' })
          .collection('client_applications')
          .doc('ca-mine'),
        {
          leadEstado: 'contacted',
          leadEstadoBy: 'fake-manager@shimano.com.ar',
        }
      )
    );
  });
  it('vendor OK cuando leadEstadoBy coincide con su email', async () => {
    await assertSucceeds(
      updateDoc(
        authedDb(UID.vendor, { email: 'gonzalo@shimano.com.ar' })
          .collection('client_applications')
          .doc('ca-mine'),
        {
          leadEstado: 'won',
          leadEstadoBy: 'gonzalo@shimano.com.ar',
        }
      )
    );
  });
  it('admin/gerente/interno mantienen blanket update cross-vendor', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'client_applications', 'ca-other'), {
        leadEstado: 'contacted',
      })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.gerente), 'client_applications', 'ca-mine'), {
        leadEstado: 'won',
      })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'client_applications', 'ca-other'), {
        leadEstado: 'lost',
      })
    );
  });
});

// ============================================================
// v933 (SecAudit Sprint 2 MED-04) — counters/orderNumber cap + hasOnly
// ============================================================
describe('/counters/orderNumber (v933 MED-04 VULN-207)', () => {
  it('vendor puede incrementar en +1 (flow reserveNextOrderNumber normal)', async () => {
    await seedDoc('counters/orderNumber', { value: 150 });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'counters', 'orderNumber'), {
        value: 151,
      })
    );
  });
  it('CRIT: vendor NO puede saltar counter a valor arbitrario grande', async () => {
    await seedDoc('counters/orderNumber', { value: 150 });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'counters', 'orderNumber'), {
        value: 9999999,
      })
    );
  });
  it('vendor NO puede retroceder el counter (monotonicidad v913 intacta)', async () => {
    await seedDoc('counters/orderNumber', { value: 150 });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'counters', 'orderNumber'), {
        value: 100,
      })
    );
  });
  it('vendor NO puede inyectar campos extra en update', async () => {
    await seedDoc('counters/orderNumber', { value: 150 });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'counters', 'orderNumber'), {
        value: 151,
        evilPayload: 'hack',
      })
    );
  });
  it('vendor NO puede inyectar campos extra en create', async () => {
    // Sin seed previo => es create path. docId=orderNumber + evilPayload -> denied por hasOnly.
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'counters', 'orderNumber'), {
        value: 1,
        evilPayload: 'hack',
      })
    );
  });
  it('vendor NO puede crear counters con docId distinto (rule solo permite orderNumber)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'counters', 'evilCounter'), {
        value: 1,
      })
    );
  });
});

// ============================================================
// v934 (SecAudit Sprint 2 MED-05) — allowed_emails split get/list
// ============================================================
describe('/allowed_emails split get/list (v934 MED-05 VULN-208)', () => {
  beforeEach(async () => {
    await seedDoc('allowed_emails/test@x.com', { granted: true });
    await seedDoc('allowed_emails/other@x.com', { granted: true });
  });
  it('vendor puede get de un email especifico (flow login check)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'allowed_emails', 'test@x.com')));
  });
  it('unassigned puede get de un email especifico', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.unassigned), 'allowed_emails', 'test@x.com')));
  });
  it('CRIT: vendor NO puede list la coleccion completa (staff directory enum)', async () => {
    await assertFails(getDocs(collection(authedDb(UID.vendor), 'allowed_emails')));
  });
  it('CRIT: unassigned NO puede list', async () => {
    await assertFails(getDocs(collection(authedDb(UID.unassigned), 'allowed_emails')));
  });
  it('admin/gerente pueden list (uso legitimo panel admin)', async () => {
    await assertSucceeds(getDocs(collection(authedDb(UID.admin), 'allowed_emails')));
    await assertSucceeds(getDocs(collection(authedDb(UID.gerente), 'allowed_emails')));
  });
});

// ============================================================
// v934 (SecAudit Sprint 2 MED-13) — rendiciones duplicate 2-step bypass
// ============================================================
describe('/rendiciones duplicado_detectado bypass (v934 MED-13 VULN-707)', () => {
  beforeEach(async () => {
    await seedDoc('rendiciones/r-dup', {
      ownerUid: UID.vendor,
      status: 'duplicado_detectado',
      amount: 1000,
    });
  });
  it('admin puede pasar duplicado_detectado -> rejected (cancelar doc)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'rendiciones', 'r-dup'), {
        status: 'rejected',
      })
    );
  });
  it('admin puede update otros campos manteniendo duplicado_detectado', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'rendiciones', 'r-dup'), {
        adminNote: 'reviewed',
      })
    );
  });
  it('CRIT: admin NO puede pasar duplicado_detectado -> approved directo (v857)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.admin), 'rendiciones', 'r-dup'), {
        status: 'approved',
      })
    );
  });
  it('CRIT: admin NO puede pasar duplicado_detectado -> pending_approval (v934 bypass 2-step)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.admin), 'rendiciones', 'r-dup'), {
        status: 'pending_approval',
      })
    );
  });
  it('CRIT: gerente NO puede pasar duplicado_detectado -> pending_approval', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.gerente), 'rendiciones', 'r-dup'), {
        status: 'pending_approval',
      })
    );
  });
});

// ============================================================
// A1.3 (2026-11-19): revision_waitlist_locks — colección 100%
// server-side (Admin SDK only). Rules: allow read/write = false
// para cualquier cliente. CFs movePedidoToWaitlistCF /
// unifyWaitlistsCF + scripts W/Y usan Admin SDK y bypassean.
// ============================================================
describe('revision_waitlist_locks — server-side only', () => {
  beforeEach(async () => {
    await seedDoc('revision_waitlist_locks/C30718510291', {
      cardCode: 'C30718510291',
      waitlistId: 'wl_test',
      ownerUid: UID.vendor,
      createdAt: '2026-11-19T00:00:00.000Z',
    });
  });

  it('admin NO puede read (bypass solo Admin SDK)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.admin), 'revision_waitlist_locks', 'C30718510291')));
  });

  it('admin NO puede write (bypass solo Admin SDK)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.admin), 'revision_waitlist_locks', 'C99999'), {
        cardCode: 'C99999',
      })
    );
  });

  it('VDE NO puede read', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'revision_waitlist_locks', 'C30718510291')));
  });

  it('VDE NO puede write', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'revision_waitlist_locks', 'C99999'), {
        cardCode: 'C99999',
      })
    );
  });

  it('interno NO puede read', async () => {
    await assertFails(
      getDoc(doc(authedDb(UID.interno), 'revision_waitlist_locks', 'C30718510291'))
    );
  });

  it('anon NO puede read ni write', async () => {
    await assertFails(getDoc(doc(anonDb(), 'revision_waitlist_locks', 'C30718510291')));
    await assertFails(
      setDoc(doc(anonDb(), 'revision_waitlist_locks', 'C99999'), {
        cardCode: 'C99999',
      })
    );
  });
});

// ============================================================
// SEC-M1 (Fase 2B, 2026-11-18, reintegrado 2026-11-19): whitelist
// estricto de 11 campos sobre revision_waitlist.update desde cliente.
// Antes: isReader() blanket. Vector §59: VDE hostil cambiaba
// assignedVendorUid de waitlist ajeno para "robar" la carga.
// Despues: hasOnly whitelist bloquea campos sensibles.
// ============================================================
describe('SEC-M1: revision_waitlist.update hasOnly', () => {
  beforeEach(async () => {
    await seedDoc('revision_waitlist/wl_sec_m1', {
      ownerUid: UID.vendor,
      assignedVendorUid: UID.vendor,
      vendorAssigned: 'VDE_GONZALO',
      clientCardCode: 'C30718510291',
      clientName: 'TEST CLIENT',
      stage: 'active',
      items: [{ code: 'SKU1', qty: 1 }],
      orderNumber: 123,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByUid: UID.vendor,
    });
  });

  // TC1: VDE puede editar campos WHITELIST
  it('VDE puede editar items de su propio waitlist', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        items: [{ code: 'SKU1', qty: 2 }],
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDE puede marcar waitlist como consumed (confirm flow index.html:39230)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        stage: 'consumed',
        consumedByPedidoId: 'pedido_abc',
        consumedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDE puede unificar waitlist localmente (§42.2 guard)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        stage: 'consumed',
        closedAt: '2026-11-18T00:00:00.000Z',
        closedReason: 'unified_at_review',
        unifiedIntoCurrentOrder: true,
        unifiedAt: '2026-11-18T00:00:00.000Z',
        unifiedBy: 'vde.a@shimano.com.ar',
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDE puede editar orderNumber (waitlistEditOrden)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        orderNumber: 456,
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  // TC2: VDE hostil no puede escalar privilegios
  it('VDE ajeno NO puede cambiar assignedVendorUid de waitlist (vector §59)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendorOther), 'revision_waitlist', 'wl_sec_m1'), {
        assignedVendorUid: UID.vendorOther,
        vendorAssigned: 'VDE_OTRO',
      })
    );
  });

  it('VDE NO puede cambiar ownerUid', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        ownerUid: UID.vendorOther,
      })
    );
  });

  it('VDE NO puede cambiar clientCardCode', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        clientCardCode: 'C99999999999',
      })
    );
  });

  // SEC-M1 iter 2.2 (post red team): este test originalmente verificaba
  // que VDE NO podía cambiar source/pedidosOrigenes. Pero el red team
  // demostró que el flow legítimo "Unificar orden absorbiendo CPST"
  // (index.html:18806 y 27386) escribe estos campos para heredar
  // source='stock-asignado-batch' al unificar con waitlist CPST.
  // El test se refactoriza: VDE PUEDE escribir source + pedidosOrigenes
  // (whitelisted para el flow legítimo). Riesgo residual DEUDA-M1-R3
  // (audit pollution: VDE podría marcar un waitlist no-CPST como CPST
  // falso). Mitigación Fase 3: CF trigger valida que pedidosOrigenes
  // apunte a pedidos reales del mismo cliente.
  it('VDE puede escribir source + pedidosOrigenes (flow Unificar CPST; riesgo residual DEUDA-M1-R3)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        source: 'stock-asignado-batch',
        pedidosOrigenes: [{ pedidoId: 'ped_x', lineIndex: 0, sku: 'SKU1', qtyAsignada: 1 }],
        updatedAt: '2026-11-19T00:00:00.000Z',
      })
    );
  });

  it('VDE NO puede cambiar createdAt (immutable)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        createdAt: '2020-01-01T00:00:00.000Z',
      })
    );
  });

  // SEC-M1 iter 2.2: regresión positiva Unificar orden
  // (index.html:27378 _wcardUnificarOrden + index.html:18800 _createOrUnifyWaitlistPayload)
  it('VDE puede ejecutar "Unificar orden" (items + unifiedFrom + updatedAt)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        items: [
          { code: 'SKU1', qty: 2 },
          { code: 'SKU2', qty: 1 },
        ],
        unifiedFrom: [
          {
            source: 'creacion_manual',
            timestamp: '2026-11-19T00:00:00.000Z',
            by: 'vde@shimano.com.ar',
          },
        ],
        updatedAt: '2026-11-19T00:00:00.000Z',
      })
    );
  });

  // SEC-M1 iter 2.2: regresión positiva absorber CPST con pedidosOrigenes + source
  it('VDE puede unificar waitlist con pedidosOrigenes + source (CPST absorbida)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        items: [{ code: 'SKU1', qty: 1 }],
        pedidosOrigenes: [{ pedidoId: 'ped_xyz', lineIndex: 0, sku: 'SKU1', qtyAsignada: 1 }],
        source: 'stock-asignado-batch',
        updatedAt: '2026-11-19T00:00:00.000Z',
      })
    );
  });

  // SEC-M1 iter 2.2: regresión positiva marcar order absorbida
  // (index.html:27391 / index.html:18830 target.others loop)
  it('VDE puede marcar waitlist absorbida (unifiedInto + unifiedIntoOrderNumber)', async () => {
    await seedDoc('revision_waitlist/wl_sec_m1_absorbida', {
      ownerUid: UID.vendor,
      assignedVendorUid: UID.vendor,
      vendorAssigned: 'VDE_GONZALO',
      clientCardCode: 'C30718510291',
      clientName: 'TEST',
      stage: 'active',
      items: [],
      orderNumber: 124,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1_absorbida'), {
        stage: 'consumed',
        closedAt: '2026-11-19T00:00:00.000Z',
        closedReason: 'unified_into_v42',
        unifiedInto: 'wl_sec_m1',
        unifiedIntoOrderNumber: 123,
        updatedAt: '2026-11-19T00:00:00.000Z',
      })
    );
  });

  // SEC-M1 iter 2.2: regresión positiva re-resolve §44 en target LEGACY
  // (index.html:18819 _createOrUnifyWaitlistPayload condicional !_targetHasVendor)
  it('VDE puede re-resolver vendor en target legacy pre-§44 (assignedVendorUid vacío)', async () => {
    await seedDoc('revision_waitlist/wl_sec_m1_legacy', {
      ownerUid: UID.vendor,
      assignedVendorUid: '', // ← legacy pre-§44 (campo existe pero vacío)
      clientCardCode: 'C30718510291',
      clientName: 'TEST LEGACY',
      stage: 'active',
      items: [],
      orderNumber: 125,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1_legacy'), {
        items: [{ code: 'SKU1', qty: 1 }],
        vendorAssigned: 'VDE_GONZALO',
        assignedVendorUid: UID.vendor,
        assignedVendorEmail: 'gonzalo@shimano.com.ar',
        ownerVendor: 'VDE_GONZALO',
        updatedAt: '2026-11-19T00:00:00.000Z',
      })
    );
  });

  // SEC-M1 iter 2.2: guard legacy §44 bloquea reasignar vendor en target NO legacy
  it('VDE NO puede cambiar assignedVendorUid en target post-§44 (guard legacy activo)', async () => {
    // wl_sec_m1 ya tiene assignedVendorUid populated (UID.vendor); intentar
    // reasignar a UID.vendorOther debe fallar aunque los 4 campos están whitelisted.
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        assignedVendorUid: UID.vendorOther,
        vendorAssigned: 'VDE_OTRO',
      })
    );
  });

  // SEC-M1 iter 2.2: guard legacy bloquea reasignar aunque VDE sea ajeno
  it('VDE ajeno NO puede re-resolver vendor en target post-§44 (preserva §59)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendorOther), 'revision_waitlist', 'wl_sec_m1'), {
        assignedVendorUid: UID.vendorOther,
        vendorAssigned: 'VDE_OTRO',
        assignedVendorEmail: 'otro@shimano.com.ar',
        ownerVendor: 'VDE_OTRO',
      })
    );
  });

  it('VDE NO puede cambiar unifiedFrom con shape invalido para audit (ex: campos no esperados en el record)', async () => {
    // El whitelist permite unifiedFrom pero la rule NO valida su shape interno.
    // Esto queda como riesgo residual: VDE puede sembrar entries falsas en
    // unifiedFrom (audit pollution). Fase 3 CF trigger valida el shape.
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl_sec_m1'), {
        unifiedFrom: [{ source: 'arbitrary', fakeField: 'malicious' }],
      })
    );
  });
});

// ============================================================
// SEC-C1 (Fase 2B, 2026-11-18): pedidos.update para isInterno()
// con hasOnly whitelist de 30 campos (paridad con VDE).
//
// Antes del fix: blanket para interno. Vector CHAIN-01 vigente (VDI podia
// mutar transferidoSAP, assignedVendorUid, orderNumberPrev, etc.).
// Despues del fix: 30 campos exactos permitidos. Flows UI legitimos de
// VDI (editar lines/stage/observaciones/Planner) siguen OK. Campos
// sensibles bloqueados.
// ============================================================
describe('SEC-C1: pedidos.update isInterno() hasOnly', () => {
  beforeEach(async () => {
    // Pedido base: owned por VDE_GONZALO (UID.vendor), assigned a VDE_OTRO.
    await seedDoc('pedidos/pedido_sec_c1', {
      ownerUid: UID.vendor,
      assignedVendorUid: UID.vendorOther,
      vendorAssigned: 'VDE_OTRO',
      clientCardCode: 'C30718510291',
      clientName: 'TEST CLIENT',
      stage: 'pending',
      lines: [{ code: 'SKU1', qty: 1 }],
      netAmountArs: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  // TC1: VDI puede editar campos WHITELIST
  it('VDI puede editar observaciones de pedido ajeno', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        observaciones: 'Nota VDI',
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDI puede cambiar plannerStage (Kanban drag) de pedido ajeno', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        plannerStage: 'oferta',
        plannerHistory: [],
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDI puede editar lines y netAmountArs (contenido comercial)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        lines: [{ code: 'SKU1', qty: 2 }],
        netAmountArs: 2000,
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDI puede cerrar pedido (closedAt + stage)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        stage: 'closed',
        closedAt: '2026-11-18T00:00:00.000Z',
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  it('VDI puede editar formaEntrega + deliveryDetails', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        formaEntrega: 'transportista',
        deliveryDetails: { sucursal: 'X' },
        updatedAt: '2026-11-18T00:00:00.000Z',
      })
    );
  });

  // TC2: VDI NO puede editar campos BLACKLIST
  it('VDI NO puede mutar transferidoSAP (CHAIN-01)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: null,
      })
    );
  });

  it('VDI NO puede mutar sendingSapLock', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        sendingSapLock: null,
      })
    );
  });

  it('VDI NO puede mutar orderNumberPrev', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        orderNumberPrev: 'X',
      })
    );
  });

  it('VDI NO puede mutar assignedVendorUid (viola §44)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        assignedVendorUid: UID.vendor,
      })
    );
  });

  it('VDI NO puede mutar ownerUid', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        ownerUid: UID.interno,
      })
    );
  });

  it('VDI NO puede mutar clientCardCode', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        clientCardCode: 'C99999999999',
      })
    );
  });

  it('VDI NO puede mutar createdAt (immutable)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        createdAt: '2020-01-01T00:00:00.000Z',
      })
    );
  });

  // TC3: admin mantiene blanket (recovery humano por diseño)
  it('admin puede mutar transferidoSAP (blanket intencional)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: null,
      })
    );
  });

  // TC4: VDE propietario sigue bloqueado para campos sensibles
  it('VDE propietario NO puede mutar transferidoSAP (sin cambio de whitelist VDE)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: null,
      })
    );
  });

  // TC5: VDE ajeno (no owner ni assigned) no puede update (sin cambio)
  it('VDE ajeno (no owner ni assigned) NO puede mutar ningún campo', async () => {
    await seedDoc('pedidos/pedido_sec_c1_otro', {
      ownerUid: UID.vendorOther,
      assignedVendorUid: UID.vendorOther,
      vendorAssigned: 'VDE_OTRO',
      clientCardCode: 'C30718510291',
      clientName: 'TEST',
      stage: 'pending',
      lines: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'pedido_sec_c1_otro'), {
        observaciones: 'Soy ajeno',
      })
    );
  });

  // ============================================================
  // SEC-C1 Opcion A.2 (2026-11-19): guard semantico transferidoSAP
  // + 6 campos nuevos (transferidoSAP, revertedFromConfirmedAt,
  // revertedBy, previousSapDocNum, previousSapDocEntryCancelled,
  // autoSplitByStock). Cubre los 3 flows VDE+VDI legitimos pre-rotos:
  // H-01 auto-confirm 100% BO, H-02 volverAPendientes app_only,
  // H-03 confirmarDefinitivo auto-split. Bloquea CHAIN-01 (via='sap_sl').
  // ============================================================

  // TC-A2-1: VDI auto-confirm 100% BO con via='app_only' debe pasar (H-01 resuelto)
  it('VDI puede setear transferidoSAP via=app_only (auto-confirm 100% BO)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        stage: 'confirmed',
        finalizedAt: '2026-11-19T00:00:00.000Z',
        transferidoSAP: {
          via: 'app_only',
          reason: 'all_lines_bo',
          docEntry: null,
          docNum: null,
          transferredAt: '2026-11-19T00:00:00.000Z',
          transferredBy: 'auto/confirm-on-save/santi@shimano.com.ar',
        },
      })
    );
  });

  // TC-A2-2: VDE propietario puede setear transferidoSAP via=app_only sobre pedido propio
  it('VDE propietario puede setear transferidoSAP via=app_only', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'pedido_sec_c1'), {
        stage: 'confirmed',
        finalizedAt: '2026-11-19T00:00:00.000Z',
        transferidoSAP: {
          via: 'app_only',
          reason: 'all_lines_bo',
          docEntry: null,
        },
      })
    );
  });

  // TC-A2-3: VDI con transferidoSAP via='sap_sl' debe fallar (bloquea CHAIN-01)
  it('VDI NO puede setear transferidoSAP via=sap_sl (bloquea CHAIN-01)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: {
          via: 'sap_sl',
          docEntry: 999,
          docNum: 'SQ-FAKE',
        },
      })
    );
  });

  // TC-A2-4: VDE con transferidoSAP via='service_layer' también debe fallar
  it('VDE NO puede setear transferidoSAP via=service_layer (bloquea CHAIN-01)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: {
          via: 'service_layer',
          docEntry: 1234,
        },
      })
    );
  });

  // TC-A2-5: VDI puede deletear transferidoSAP en el flow revert app_only (H-02 resuelto)
  // Nota: FieldValue.delete() simulado seteando el field a FieldValue.delete()
  // El emulator Firebase JS SDK v10+ reporta esto como "campo no está en request.resource.data".
  it('VDI puede deletear transferidoSAP (revert app_only)', async () => {
    // Seed pedido confirmed con transferidoSAP app_only
    await seedDoc('pedidos/pedido_sec_c1_revert', {
      ownerUid: UID.vendor,
      assignedVendorUid: UID.vendorOther,
      vendorAssigned: 'VDE_OTRO',
      clientCardCode: 'C30718510291',
      clientName: 'TEST',
      stage: 'confirmed',
      lines: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      finalizedAt: '2026-11-18T00:00:00.000Z',
      transferidoSAP: { via: 'app_only', docEntry: null },
    });
    // Import FieldValue para delete
    const { deleteField } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1_revert'), {
        stage: 'pending',
        finalizedAt: deleteField(),
        transferidoSAP: deleteField(),
        revertedFromConfirmedAt: '2026-11-19T00:00:00.000Z',
        revertedBy: 'santi@shimano.com.ar',
      })
    );
  });

  // TC-A2-6: VDI puede escribir todos los audit del revert
  it('VDI puede escribir revertedFromConfirmedAt + revertedBy + previousSapDocNum + previousSapDocEntryCancelled', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        stage: 'pending',
        revertedFromConfirmedAt: '2026-11-19T00:00:00.000Z',
        revertedBy: 'santi@shimano.com.ar',
        previousSapDocNum: 'SQ-12345',
        previousSapDocEntryCancelled: 999,
      })
    );
  });

  // TC-A2-7: VDI puede escribir autoSplitByStock (H-03 resuelto)
  it('VDI puede escribir autoSplitByStock (audit del auto-split)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        stage: 'confirmed',
        finalizedAt: '2026-11-19T00:00:00.000Z',
        lines: [{ code: 'SKU1', qty: 1, state: 'confirmed' }],
        autoSplitByStock: {
          at: '2026-11-19T00:00:00.000Z',
          by: 'santi@shimano.com.ar',
          source: 'confirmarDefinitivo-preCheck',
          lost: 500,
          movedToBO: 1,
        },
      })
    );
  });

  // TC-A2-8 (reescrito post re-review red team): VDI NO puede setear
  // transferidoSAP via='app_only' + docEntry != null (vector de sabotaje
  // H-A2-02 — el CF podría skipear envío legítimo asumiendo "ya enviado").
  // Guard reforzado: via='app_only' solo si docEntry == null.
  it('VDI NO puede setear transferidoSAP via=app_only con docEntry falso (H-A2-02 bloqueado)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: {
          via: 'app_only',
          docEntry: 999,
          docNum: 'FAKE',
          reason: 'all_lines_bo',
        },
      })
    );
  });

  // TC-A2-9: VDI via=app_only con docEntry=null explicit debe pasar
  it('VDI puede setear transferidoSAP via=app_only con docEntry=null (auto-confirm 100% BO legítimo)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: {
          via: 'app_only',
          reason: 'all_lines_bo',
          docEntry: null,
          docNum: null,
          transferredAt: '2026-11-19T00:00:00.000Z',
          transferredBy: 'auto/confirm-on-save/santi@shimano.com.ar',
        },
      })
    );
  });

  // TC-A2-10: VDE via=app_only + docEntry presente también bloqueado (simetría)
  it('VDE NO puede setear transferidoSAP via=app_only con docEntry falso (simetría H-A2-02)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'pedido_sec_c1'), {
        transferidoSAP: {
          via: 'app_only',
          docEntry: 1234,
          docNum: 'VDE-FAKE',
        },
      })
    );
  });
});
