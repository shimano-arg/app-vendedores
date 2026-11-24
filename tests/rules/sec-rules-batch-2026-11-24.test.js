/**
 * Lote de seguridad de reglas 2026-11-24 (firestore.rules + storage.rules).
 *
 * Cubre los ajustes propios del lote sobre los PRs integrados y los flujos
 * reales de vendedores que podian romperse:
 * - pedidos.update: guard de transferidoSAP (solo app_only) y VDI sin descuento.
 * - notifications / operations_log: campos que escriben hoy los call-sites.
 * - revision_waitlist.update: ruta del Excel subido.
 * - client_applications: status al crear (alta rapida), formulario publico
 *   cerrado (C-01), y flujos admin que NO deben romperse (aprobar, reasignar,
 *   unir leads).
 * - roles.create: email del token (H10); roles.update D14/D18.
 * - Lote B: lecturas que pasan de "logueado" a "rol aprobado".
 *
 * Correr con: firebase emulators:exec --only firestore,storage \
 *   "npx vitest run tests/rules/ --fileParallelism=false"
 */
import { serverTimestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addDoc,
  anonDb,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  collection,
  doc,
  emulatorUnavailable,
  getDoc,
  getDocs,
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
  await seedCanonicalRoles();
});

describe('precondición', () => {
  it('el emulador está disponible (si no, estos tests no prueban nada)', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});

// ------------------------------------------------------------------
// pedidos.update — ajuste #1375
// ------------------------------------------------------------------
describe('pedidos.update — transferidoSAP solo app_only (ajuste #1375)', () => {
  const base = (extra = {}) => ({
    ownerUid: UID.vendor,
    assignedVendorUid: UID.vendor,
    stage: 'confirmed',
    lines: [{ code: 'SKU1', qty: 1, state: 'confirmed' }],
    ...extra,
  });

  it('VDE edita su pedido (lines + stage + formaEntrega)', async () => {
    await seedDoc('pedidos/p-vde-edit', base({ stage: 'pending' }));
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vde-edit'), {
        lines: [{ code: 'SKU1', qty: 2, state: 'confirmed' }],
        stage: 'confirmed',
        formaEntrega: 'retiro',
      })
    );
  });

  it('VDE marca su pedido 100% BO como app_only (auto-confirm)', async () => {
    await seedDoc('pedidos/p-app-only-set', base({ stage: 'pending' }));
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-app-only-set'), {
        stage: 'confirmed',
        transferidoSAP: { via: 'app_only', reason: 'all_lines_bo', docEntry: null, docNum: null },
      })
    );
  });

  it('VDE borra transferidoSAP si el previo es app_only', async () => {
    const { deleteField } = await import('firebase/firestore');
    await seedDoc(
      'pedidos/p-app-only-del',
      base({ transferidoSAP: { via: 'app_only', docEntry: null } })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-app-only-del'), {
        stage: 'pending',
        transferidoSAP: deleteField(),
      })
    );
  });

  it('VDE NO borra transferidoSAP de un pedido con cotizacion real en SAP', async () => {
    const { deleteField } = await import('firebase/firestore');
    await seedDoc(
      'pedidos/p-sap-del',
      base({ transferidoSAP: { via: 'service_layer_auto', docEntry: 123, docNum: 2000123 } })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-sap-del'), {
        transferidoSAP: deleteField(),
      })
    );
  });

  it('VDI NO reescribe como app_only un pedido que ya fue a SAP', async () => {
    await seedDoc(
      'pedidos/p-sap-rewrite',
      base({ transferidoSAP: { via: 'service_layer_auto', docEntry: 123, docNum: 2000123 } })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-sap-rewrite'), {
        transferidoSAP: { via: 'app_only', docEntry: null },
      })
    );
  });

  it('admin SI puede borrar transferidoSAP de un pedido en SAP (recovery)', async () => {
    const { deleteField } = await import('firebase/firestore');
    await seedDoc(
      'pedidos/p-sap-admin',
      base({ transferidoSAP: { via: 'service_layer_auto', docEntry: 9 } })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'pedidos', 'p-sap-admin'), {
        transferidoSAP: deleteField(),
      })
    );
  });

  it('VDI NO edita discountPct (whitelist VDI sin descuento)', async () => {
    await seedDoc('pedidos/p-vdi-disc', base());
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-vdi-disc'), { discountPct: 10 })
    );
  });

  it('interno mueve el planner de un pedido ajeno (plannerStage + plannerHistory)', async () => {
    await seedDoc(
      'pedidos/p-planner',
      base({ ownerUid: UID.vendorOther, assignedVendorUid: UID.vendorOther })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-planner'), {
        plannerStage: 'facturar',
        plannerHistory: [{ stage: 'facturar', at: '2026-11-24T00:00:00Z' }],
        updatedAt: '2026-11-24T00:00:00Z',
      })
    );
  });

  it('VDI NO cambia ownerUid ni campos fuera de whitelist', async () => {
    await seedDoc('pedidos/p-vdi-owner', base());
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'pedidos', 'p-vdi-owner'), { ownerUid: UID.interno })
    );
  });
});

// ------------------------------------------------------------------
// notifications — ajuste #1380
// ------------------------------------------------------------------
describe('notifications — whitelist con campos reales (ajuste #1380)', () => {
  it('aviso de alta de cliente (applicationId + targetEmail + description)', async () => {
    await assertSucceeds(
      addDoc(collection(authedDb(UID.vendor), 'notifications'), {
        type: 'alta_cliente',
        fromUid: UID.vendor,
        fromEmail: 'v@shimano.com.ar',
        fromName: 'Vendedor',
        targetUid: UID.admin,
        targetEmail: 'a@shimano.com.ar',
        title: 'Nueva alta',
        description: 'x',
        applicationId: 'ca-1',
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    );
  });

  it('aviso de alta rapida (comercio)', async () => {
    await assertSucceeds(
      addDoc(collection(authedDb(UID.vendor), 'notifications'), {
        type: 'alta_rapida_creada',
        fromUid: UID.vendor,
        fromEmail: 'v@shimano.com.ar',
        targetUid: UID.admin,
        title: 't',
        body: 'b',
        comercio: 'Local X',
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    );
  });

  it('tarea con fotos (images + targetName)', async () => {
    await assertSucceeds(
      addDoc(collection(authedDb(UID.admin), 'notifications'), {
        type: 'task',
        fromUid: UID.admin,
        fromEmail: 'a@shimano.com.ar',
        fromName: 'Admin',
        targetUid: UID.vendor,
        targetEmail: 'v@shimano.com.ar',
        targetName: 'Vendedor',
        title: 'Tarea',
        description: 'Hacer X',
        images: ['data:image/jpeg;base64,AAAA'],
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    );
  });

  it('NO acepta campos fuera de la whitelist', async () => {
    await assertFails(
      addDoc(collection(authedDb(UID.vendor), 'notifications'), {
        type: 'task',
        fromUid: UID.vendor,
        targetUid: UID.admin,
        title: 't',
        extraField: 'x',
      })
    );
  });

  it('NO acepta fromUid ajeno', async () => {
    await assertFails(
      addDoc(collection(authedDb(UID.vendor), 'notifications'), {
        type: 'task',
        fromUid: UID.admin,
        targetUid: UID.vendorOther,
        title: 't',
      })
    );
  });

  it('el destinatario marca la tarea como hecha; no reescribe el titulo', async () => {
    await seedDoc('notifications/n-1', {
      type: 'task',
      fromUid: UID.admin,
      targetUid: UID.vendor,
      title: 'T',
      status: 'pending',
    });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'notifications', 'n-1'), {
        status: 'done',
        doneAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'notifications', 'n-1'), { title: 'otro' })
    );
  });
});

// ------------------------------------------------------------------
// operations_log — ajuste #1381
// ------------------------------------------------------------------
describe('operations_log — whitelist con campos reales (ajuste #1381)', () => {
  it('logOp del panel (sin type)', async () => {
    await assertSucceeds(
      addDoc(collection(authedDb(UID.vendor), 'operations_log'), {
        action: 'revertir_a_pendiente',
        entityType: 'pedido',
        entityName: 'Cliente',
        details: { key: 'x' },
        userUid: UID.vendor,
        userEmail: 'v@shimano.com.ar',
        userRole: 'vendedor',
        timestamp: serverTimestamp(),
      })
    );
  });

  it('fallback de commit con firebaseCode + skus', async () => {
    await assertSucceeds(
      addDoc(collection(authedDb(UID.vendor), 'operations_log'), {
        type: 'commitPedidoCF_fallback_legacy',
        motivo: 'timeout',
        firebaseCode: 'deadline-exceeded',
        draftId: 'd1',
        cardCode: 'C1',
        clientName: 'X',
        skus: ['SKU1'],
        userUid: UID.vendor,
        userEmail: 'v@shimano.com.ar',
        clientVersion: 'v1',
        timestamp: '2026-11-24T00:00:00Z',
      })
    );
  });

  it('export_failed (exports-reparto)', async () => {
    await assertSucceeds(
      addDoc(collection(authedDb(UID.admin), 'operations_log'), {
        type: 'export_failed',
        exportKind: 'reparto',
        error: 'boom',
        userUid: UID.admin,
        userEmail: 'a@shimano.com.ar',
        timestamp: new Date(),
      })
    );
  });

  it('NO acepta un type del servidor', async () => {
    await assertFails(
      addDoc(collection(authedDb(UID.vendor), 'operations_log'), {
        type: 'commit_pedido_warning',
        userUid: UID.vendor,
        timestamp: new Date(),
      })
    );
  });
});

// ------------------------------------------------------------------
// revision_waitlist.update — ajuste #1376
// ------------------------------------------------------------------
describe('revision_waitlist.update — Excel subido (ajuste #1376)', () => {
  beforeEach(async () => {
    await seedDoc('revision_waitlist/wl-x', {
      ownerUid: UID.vendor,
      assignedVendorUid: UID.vendor,
      clientCardCode: 'C30718510291',
      items: [],
      stage: 'active',
    });
  });

  it('VDE guarda la ruta del Excel original', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl-x'), {
        sourceExcelPath: `waitlist-excels/${UID.vendor}/wl-x.xlsx`,
        sourceExcelName: 'pedido.xlsx',
      })
    );
  });

  it('VDE NO cambia clientCardCode por update', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl-x'), {
        clientCardCode: 'C999',
      })
    );
  });

  it('prospecto sin codigo SAP puede quedar en espera (create con clientCardCode vacio)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'revision_waitlist', 'wl-prospecto'), {
        ownerUid: UID.vendor,
        clientCardCode: '',
        clientName: 'Prospecto',
        items: [{ code: 'SKU1', qty: 1 }],
      })
    );
  });
});

// ------------------------------------------------------------------
// client_applications — status al crear (#1398 parte sana + ajuste)
// ------------------------------------------------------------------
describe('client_applications.create autenticado — status', () => {
  it('alta rapida del vendedor nace approved (source alta_rapida + manualSapPending)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-rapida'), {
        comercio: 'Local',
        status: 'approved',
        source: 'alta_rapida',
        manualSapPending: true,
        assignedVendor: 'VDE_GONZALO',
        ownerUid: UID.vendor,
      })
    );
  });

  it('vendedor NO crea un alta approved sin ser alta rapida', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-auto-aprob'), {
        comercio: 'Local',
        status: 'approved',
        ownerUid: UID.vendor,
      })
    );
  });

  it('vendedor NO crea con status fuera de la lista', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-rej'), {
        comercio: 'Local',
        status: 'rejected',
        ownerUid: UID.vendor,
      })
    );
  });

  it('import SAP del admin crea approved', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.admin), 'client_applications', 'sap_C1'), {
        comercio: 'SAP SRL',
        cardCodeSap: 'C1',
        status: 'approved',
        source: 'sap_bulk_import',
        ownerUid: UID.admin,
      })
    );
  });
});

describe('client_applications.update — flujos admin que no deben romperse', () => {
  beforeEach(async () => {
    await seedDoc('client_applications/ca-flow', {
      comercio: 'Local',
      status: 'pending_approval',
      ownerUid: UID.vendor,
      assignedVendor: 'VDE_GONZALO',
      approvals: {},
    });
  });

  it('aprobar alta (approvals + status)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'client_applications', 'ca-flow'), {
        approvals: { [UID.admin]: { email: 'a@x', approvedAt: serverTimestamp() } },
        status: 'approved',
        approvedAt: serverTimestamp(),
      })
    );
  });

  it('reasignar zona (assignedVendor + reassignedAt/By + ownerUid)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.gerente), 'client_applications', 'ca-flow'), {
        assignedVendor: 'VDE_OTRO',
        reassignedAt: serverTimestamp(),
        reassignedBy: 'g@x',
        ownerUid: UID.vendorOther,
      })
    );
  });

  it('unir lead con cliente SAP (mergedFrom* + razonSocial + provincia)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'client_applications', 'ca-flow'), {
        mergedFromSapFsId: 'sap_C1',
        mergedFromCardCode: 'C1',
        mergedAt: serverTimestamp(),
        mergedBy: 'i@x',
        provincia: 'CORDOBA',
        razonSocial: 'SAP SRL',
      })
    );
  });
});

// ------------------------------------------------------------------
// client_applications — formulario publico (C-01)
// ------------------------------------------------------------------
describe('client_applications.create publico (C-01)', () => {
  const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcG';
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';
  /** Payload igual al que arma alta-cliente.html submitForm. */
  const publico = (extra = {}) => ({
    email: 'cliente@example.com',
    comercio: 'Pesca Test SRL',
    fantasia: 'Pesca Test',
    cuit: '20123456789',
    condicionFiscal: 'Responsable Inscripto',
    calle: 'Calle',
    numero: '123',
    localidad: 'Rosario',
    provincia: 'SANTA FE',
    cp: '2000',
    telefono: '341000000',
    web: 'https://example.com',
    redes: '@pesca',
    contactoNombre: 'Juan',
    contactoTelParticular: '341',
    contactoWhatsapp: '341',
    contactoEmail: 'juan@example.com',
    tipoComercio: 'Pesca',
    tiendaOnline: 'No',
    constanciaArca: PDF,
    constanciaIIBB: null,
    fotosLocal: [IMG, IMG],
    submittedByPublicForm: true,
    ownerUid: '__public__',
    ownerEmail: 'external_submission',
    ownerName: 'Cliente externo',
    vendor: null,
    status: 'pending_approval',
    approvals: {},
    createdAt: serverTimestamp(),
    ...extra,
  });

  it('acepta el payload real del formulario', async () => {
    await assertSucceeds(addDoc(collection(anonDb(), 'client_applications'), publico()));
  });

  it('acepta el link de un vendedor con rol (ownerUid real)', async () => {
    await assertSucceeds(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ ownerUid: UID.vendor, ownerEmail: 'v@x', ownerName: 'V' })
      )
    );
  });

  it('acepta un adjunto grande (~400 KB base64)', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(400000)}`;
    await assertSucceeds(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ constanciaArca: big, fotosLocal: [big] })
      )
    );
  });

  it('rechaza assignedVendor', async () => {
    await assertFails(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ assignedVendor: 'VDE_GONZALO' })
      )
    );
  });

  it('rechaza campos fuera de la lista (cardCodeSap)', async () => {
    await assertFails(
      addDoc(collection(anonDb(), 'client_applications'), publico({ cardCodeSap: 'C1' }))
    );
  });

  it('rechaza un adjunto que no es data URI base64', async () => {
    await assertFails(
      addDoc(collection(anonDb(), 'client_applications'), publico({ constanciaArca: 'x" y="z' }))
    );
  });

  it('rechaza una foto invalida dentro de fotosLocal', async () => {
    await assertFails(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ fotosLocal: [IMG, 'javascript:1'] })
      )
    );
  });

  it('rechaza mas de 5 fotos', async () => {
    await assertFails(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ fotosLocal: [IMG, IMG, IMG, IMG, IMG, IMG] })
      )
    );
  });

  it('rechaza ownerUid inexistente', async () => {
    await assertFails(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ ownerUid: 'uid-que-no-existe' })
      )
    );
  });

  it('rechaza approvals precargadas y vendor seteado', async () => {
    await assertFails(
      addDoc(
        collection(anonDb(), 'client_applications'),
        publico({ approvals: { x: { ok: true } } })
      )
    );
    await assertFails(
      addDoc(collection(anonDb(), 'client_applications'), publico({ vendor: 'VDE_GONZALO' }))
    );
  });

  it('rechaza textos mas largos que el maximo', async () => {
    await assertFails(
      addDoc(collection(anonDb(), 'client_applications'), publico({ calle: 'x'.repeat(201) }))
    );
  });
});

// ------------------------------------------------------------------
// roles — H10 + D14/D18
// ------------------------------------------------------------------
describe('roles.create — email del token (H10)', () => {
  it('permite crear con el email del token', async () => {
    await assertSucceeds(
      setDoc(
        doc(authedDb('uid-h10-ok', { email: 'nuevo@shimano.com.ar' }), 'roles', 'uid-h10-ok'),
        {
          email: 'nuevo@shimano.com.ar',
          displayName: 'Nuevo',
          role: 'unassigned',
          vendor: null,
          createdAt: serverTimestamp(),
        }
      )
    );
  });

  it('rechaza un email distinto al del token', async () => {
    await assertFails(
      setDoc(
        doc(authedDb('uid-h10-bad', { email: 'nuevo@shimano.com.ar' }), 'roles', 'uid-h10-bad'),
        {
          email: 'otra.persona@shimano.com.ar',
          role: 'unassigned',
          vendor: null,
        }
      )
    );
  });

  it('sin email en el token, solo email vacio', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb('uid-h10-empty'), 'roles', 'uid-h10-empty'), {
        email: '',
        role: 'unassigned',
      })
    );
    await assertFails(
      setDoc(doc(authedDb('uid-h10-empty2'), 'roles', 'uid-h10-empty2'), {
        email: 'x@shimano.com.ar',
        role: 'unassigned',
      })
    );
  });
});

describe('roles.update — D14/D18 (#1398 parte sana)', () => {
  const MARIANO = { email: 'erbinomariano@gmail.com' };

  it('Mariano asigna internalPartnerUid', async () => {
    await seedRole('uid-mariano', 'admin');
    await assertSucceeds(
      updateDoc(doc(authedDb('uid-mariano', MARIANO), 'roles', UID.vendorOther), {
        internalPartnerUid: UID.interno,
      })
    );
  });

  it('admin no-Mariano NO asigna internalPartnerUid', async () => {
    await assertFails(
      updateDoc(
        doc(authedDb(UID.admin, { email: 'otro.admin@shimano.com.ar' }), 'roles', UID.vendorOther),
        {
          internalPartnerUid: UID.admin,
        }
      )
    );
  });

  it('admin sin email en el token sigue asignando rol (isMariano null-safe)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.unassigned), { role: 'vendedor' })
    );
  });
});

// ------------------------------------------------------------------
// Lote B — lecturas que exigen rol aprobado
// ------------------------------------------------------------------
describe('Lote B — lecturas solo con rol', () => {
  beforeEach(async () => {
    await seedDoc('client_buyer_stats/C001', { total: 1 });
    await seedDoc('app_config/feature_flags', { dep12_reparto_enabled: false });
    await seedDoc('app_config/planner_config', { enabledForAllRoles: true });
    await seedDoc('allowed_emails/nuevo_shimano_com_ar', { email: 'nuevo@shimano.com.ar' });
    await seedDoc('allowed_emails/otro_shimano_com_ar', { email: 'otro@shimano.com.ar' });
  });

  it('vendedor y viewer leen client_buyer_stats', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'client_buyer_stats', 'C001')));
    await assertSucceeds(getDoc(doc(authedDb(UID.viewer), 'client_buyer_stats', 'C001')));
  });

  it('usuario sin rol NO lee ni lista client_buyer_stats', async () => {
    await assertFails(getDoc(doc(authedDb(UID.unassigned), 'client_buyer_stats', 'C001')));
    await assertFails(getDocs(collection(authedDb(UID.unassigned), 'client_buyer_stats')));
    await assertFails(getDoc(doc(authedDb('uid-sin-doc'), 'client_buyer_stats', 'C001')));
  });

  it('feature_flags y planner_config: rol si, sin rol no', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'app_config', 'feature_flags')));
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'app_config', 'planner_config')));
    await assertFails(getDoc(doc(authedDb(UID.unassigned), 'app_config', 'feature_flags')));
    await assertFails(getDoc(doc(authedDb(UID.unassigned), 'app_config', 'planner_config')));
  });

  it('allowed_emails: el login sin rol lee solo el doc de su propio email', async () => {
    const db = authedDb('uid-login-nuevo', { email: 'Nuevo@Shimano.com.ar' });
    await assertSucceeds(getDoc(doc(db, 'allowed_emails', 'nuevo_shimano_com_ar')));
    await assertFails(getDoc(doc(db, 'allowed_emails', 'otro_shimano_com_ar')));
  });

  it('allowed_emails: un rol aprobado lee cualquiera (get)', async () => {
    await assertSucceeds(
      getDoc(doc(authedDb(UID.vendor), 'allowed_emails', 'otro_shimano_com_ar'))
    );
  });
});
